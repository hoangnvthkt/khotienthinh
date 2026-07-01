import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Package, Users, Wrench, Layers, Paperclip, ClipboardCheck, Search, ChevronDown, ChevronUp } from 'lucide-react';
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

const inputCls = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs outline-none focus:ring-1 focus:ring-teal-400 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200';

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

const formatPercent = (value?: number | null) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

const normalizeDecimalInput = (value: string) => value.trim().replace(/\s/g, '').replace(',', '.');

const parseNonNegativeDecimal = (value: string): number | null => {
  const normalized = normalizeDecimalInput(value);
  if (!normalized || normalized === '.' || normalized === ',') return 0;
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
};

const formatDecimalInput = (value?: number | null) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Number(n.toFixed(3))).replace('.', ',');
};

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

type VolumeSourceOption = {
  key: string;
  kind: 'task' | 'workBoq';
  label: string;
  meta?: string;
  unit?: string;
  plannedQty: number;
  task?: ProjectTask;
  workBoqItem?: ProjectWorkBoqItem;
};

type LaborSourceOption = {
  key: string;
  kind: 'catalog' | 'partner';
  label: string;
  meta?: string;
  catalogItem?: ContractLaborCatalogItem;
  partner?: BusinessPartner;
};

type MachineSourceOption = {
  key: string;
  label: string;
  meta?: string;
  item: ContractMachineCatalogItem;
};

const normalizeSearchText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
          {filtered.map((option, index) => (
            <button
              key={`${option.label}-${index}`}
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onPick(option.item);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-teal-50 dark:hover:bg-teal-950/30 border-b border-slate-50 dark:border-slate-700/50 last:border-b-0"
            >
              <div className="font-bold text-slate-700 dark:text-slate-200 truncate">{option.label}</div>
              {option.meta && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{option.meta}</div>}
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
  const [volumeQuantityDrafts, setVolumeQuantityDrafts] = useState<Record<number, string>>({});
  const [quickPanelOpen, setQuickPanelOpen] = useState<Record<'volumes' | 'labor' | 'machines', boolean>>({
    volumes: false,
    labor: false,
    machines: false,
  });
  const [volumeSourceSearch, setVolumeSourceSearch] = useState('');
  const [selectedVolumeSourceKeys, setSelectedVolumeSourceKeys] = useState<Set<string>>(new Set());
  const [laborSourceSearch, setLaborSourceSearch] = useState('');
  const [laborTaskSearch, setLaborTaskSearch] = useState('');
  const [selectedLaborSourceKeys, setSelectedLaborSourceKeys] = useState<Set<string>>(new Set());
  const [selectedLaborTaskIds, setSelectedLaborTaskIds] = useState<Set<string>>(new Set());
  const [machineSourceSearch, setMachineSourceSearch] = useState('');
  const [machineTaskSearch, setMachineTaskSearch] = useState('');
  const [selectedMachineSourceKeys, setSelectedMachineSourceKeys] = useState<Set<string>>(new Set());
  const [selectedMachineTaskIds, setSelectedMachineTaskIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setVolumeQuantityDrafts({});
  }, [volumes.length]);
  const taskOptions = useMemo<SearchOption<ProjectTask>[]>(() => tasks.map(task => ({
    item: task,
    label: `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`,
    meta: [task.fallbackUnit, task.assignee].filter(Boolean).join(' • '),
  })), [tasks]);
  const taskQuickOptions = useMemo(() => tasks.map(task => ({
    key: task.id,
    label: `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`,
    meta: [
      task.fallbackUnit ? `ĐVT ${task.fallbackUnit}` : '',
      task.assignee ? `Phụ trách: ${task.assignee}` : '',
    ].filter(Boolean).join(' • '),
    item: task,
  })), [tasks]);
  const workBoqOptions = useMemo<SearchOption<ProjectWorkBoqItem>[]>(() => workBoqItems.map(item => ({
    item,
    label: `${item.wbsCode ? `${item.wbsCode} - ` : ''}${item.name}`,
    meta: [item.unit, item.sourceTaskId ? 'Từ tiến độ' : 'Nhập tay'].filter(Boolean).join(' • '),
  })), [workBoqItems]);
  const workBoqByTaskId = useMemo(() => new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.sourceTaskId as string, item])), [workBoqItems]);
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const volumeSourceOptions = useMemo<VolumeSourceOption[]>(() => {
    const taskIdsLinkedToWorkBoq = new Set<string>();
    const options: VolumeSourceOption[] = workBoqItems.map(item => {
      if (item.sourceTaskId) taskIdsLinkedToWorkBoq.add(item.sourceTaskId);
      const task = item.sourceTaskId ? taskById.get(item.sourceTaskId) : undefined;
      const plannedQty = Number(item.plannedQty || task?.provisionalQuantity || 0);
      const unit = item.unit || task?.fallbackUnit || 'm2';
      return {
        key: `workBoq:${item.id}`,
        kind: 'workBoq',
        label: `${item.wbsCode ? `${item.wbsCode} - ` : ''}${item.name}`,
        meta: [
          task?.name ? `Tiến độ: ${task.name}` : 'BOQ thi công',
          plannedQty > 0 ? `KL ${formatQuantity(plannedQty)} ${unit}` : '',
        ].filter(Boolean).join(' • '),
        plannedQty,
        unit,
        task,
        workBoqItem: item,
      };
    });

    tasks.forEach(task => {
      if (taskIdsLinkedToWorkBoq.has(task.id)) return;
      const plannedQty = Number(task.provisionalQuantity || 0);
      const unit = task.fallbackUnit || task.unit || 'm2';
      options.push({
        key: `task:${task.id}`,
        kind: 'task',
        label: `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`,
        meta: [
          task.assignee ? `Phụ trách: ${task.assignee}` : 'Tiến độ',
          plannedQty > 0 ? `KL ${formatQuantity(plannedQty)} ${unit}` : '',
        ].filter(Boolean).join(' • '),
        plannedQty,
        unit,
        task,
      });
    });

    return options;
  }, [taskById, tasks, workBoqItems]);
  const volumeSelectableOptions = useMemo(() => volumeSourceOptions.map(option => {
    const alreadyAdded = volumes.some(volume => {
      if (option.workBoqItem?.id) return volume.workBoqItemId === option.workBoqItem.id;
      return !!option.task?.id && volume.taskId === option.task.id;
    });
    return { ...option, alreadyAdded };
  }), [volumeSourceOptions, volumes]);
  const filteredVolumeSourceOptions = useMemo(() => {
    const keyword = normalizeSearchText(volumeSourceSearch);
    return volumeSelectableOptions
      .filter(option => !keyword || normalizeSearchText(`${option.label} ${option.meta || ''}`).includes(keyword))
      .slice(0, 80);
  }, [volumeSelectableOptions, volumeSourceSearch]);
  const selectableFilteredVolumeOptions = useMemo(
    () => filteredVolumeSourceOptions.filter(option => !option.alreadyAdded),
    [filteredVolumeSourceOptions]
  );
  const allFilteredVolumeSelected = selectableFilteredVolumeOptions.length > 0
    && selectableFilteredVolumeOptions.every(option => selectedVolumeSourceKeys.has(option.key));
  const materialOptions = useMemo<SearchOption<InventoryItem>[]>(() => inventoryItems
    .filter(item => !siteWarehouseId || getWarehouseStock(item, siteWarehouseId) > 0)
    .map(item => ({
      item,
      label: `${item.sku ? `${item.sku} - ` : ''}${item.name}`,
      meta: siteWarehouseId
        ? `Tồn ${formatQuantity(getWarehouseStock(item, siteWarehouseId))} ${item.unit} tại ${siteWarehouseName || 'kho công trường'}`
        : `Tổng tồn ${formatQuantity(Object.values(item.stockByWarehouse || {}).reduce((sum, qty) => sum + Number(qty || 0), 0))} ${item.unit}`,
    })), [inventoryItems, siteWarehouseId, siteWarehouseName]);
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
  const laborSourceOptions = useMemo<LaborSourceOption[]>(() => [
    ...laborCatalogs
      .filter(item => item.status !== 'inactive')
      .map(item => ({
        key: `catalog:${item.id}`,
        kind: 'catalog' as const,
        label: `${item.code ? `${item.code} - ` : ''}${item.name}`,
        meta: [item.groupName, item.partnerName, item.unit, 'HĐ danh mục'].filter(Boolean).join(' • '),
        catalogItem: item,
      })),
    ...businessPartners
      .filter(item => item.isActive !== false)
      .map(partner => ({
        key: `partner:${partner.id}`,
        kind: 'partner' as const,
        label: partner.name,
        meta: [partner.code, describePartner(partner), partner.phone].filter(Boolean).join(' • '),
        partner,
      })),
  ], [businessPartners, laborCatalogs]);
  const machineSourceOptions = useMemo<MachineSourceOption[]>(() => machineCatalogs
    .filter(item => item.status !== 'inactive')
    .map(item => ({
      key: item.id,
      label: `${item.code ? `${item.code} - ` : ''}${item.name}`,
      meta: [item.groupName, item.unit].filter(Boolean).join(' • '),
      item,
    })), [machineCatalogs]);
  const filteredLaborSourceOptions = useMemo(() => {
    const keyword = normalizeSearchText(laborSourceSearch);
    return laborSourceOptions.filter(option => !keyword || normalizeSearchText(`${option.label} ${option.meta || ''}`).includes(keyword)).slice(0, 80);
  }, [laborSourceOptions, laborSourceSearch]);
  const filteredLaborTaskOptions = useMemo(() => {
    const keyword = normalizeSearchText(laborTaskSearch);
    return taskQuickOptions.filter(option => !keyword || normalizeSearchText(`${option.label} ${option.meta || ''}`).includes(keyword)).slice(0, 80);
  }, [laborTaskSearch, taskQuickOptions]);
  const filteredMachineSourceOptions = useMemo(() => {
    const keyword = normalizeSearchText(machineSourceSearch);
    return machineSourceOptions.filter(option => !keyword || normalizeSearchText(`${option.label} ${option.meta || ''}`).includes(keyword)).slice(0, 80);
  }, [machineSourceOptions, machineSourceSearch]);
  const filteredMachineTaskOptions = useMemo(() => {
    const keyword = normalizeSearchText(machineTaskSearch);
    return taskQuickOptions.filter(option => !keyword || normalizeSearchText(`${option.label} ${option.meta || ''}`).includes(keyword)).slice(0, 80);
  }, [machineTaskSearch, taskQuickOptions]);
  const selectedLaborSources = useMemo(
    () => laborSourceOptions.filter(option => selectedLaborSourceKeys.has(option.key)),
    [laborSourceOptions, selectedLaborSourceKeys]
  );
  const selectedLaborTasks = useMemo(
    () => taskQuickOptions.filter(option => selectedLaborTaskIds.has(option.key)).map(option => option.item),
    [selectedLaborTaskIds, taskQuickOptions]
  );
  const selectedMachineSources = useMemo(
    () => machineSourceOptions.filter(option => selectedMachineSourceKeys.has(option.key)),
    [machineSourceOptions, selectedMachineSourceKeys]
  );
  const selectedMachineTasks = useMemo(
    () => taskQuickOptions.filter(option => selectedMachineTaskIds.has(option.key)).map(option => option.item),
    [selectedMachineTaskIds, taskQuickOptions]
  );
  const laborPairExists = (source: LaborSourceOption, task: ProjectTask) => laborDetails.some(row => {
    if (row.taskId !== task.id) return false;
    if (source.kind === 'catalog') return !!source.catalogItem?.id && row.catalogItemId === source.catalogItem.id;
    return !!source.partner?.id && row.partnerId === source.partner.id && !row.catalogItemId;
  });
  const machinePairExists = (source: MachineSourceOption, task: ProjectTask) => machines.some(row => (
    row.taskId === task.id && (row.catalogItemId === source.item.id || (!row.catalogItemId && row.machineName === source.item.name))
  ));
  const laborRowsToAdd = useMemo(() => selectedLaborSources.flatMap(source =>
    selectedLaborTasks
      .filter(task => !laborPairExists(source, task))
      .map(task => ({ source, task }))
  ), [laborDetails, selectedLaborSources, selectedLaborTasks]);
  const machineRowsToAdd = useMemo(() => selectedMachineSources.flatMap(source =>
    selectedMachineTasks
      .filter(task => !machinePairExists(source, task))
      .map(task => ({ source, task }))
  ), [machines, selectedMachineSources, selectedMachineTasks]);
  const selectedLaborPairCount = selectedLaborSources.length * selectedLaborTasks.length;
  const skippedLaborPairCount = Math.max(0, selectedLaborPairCount - laborRowsToAdd.length);
  const selectedMachinePairCount = selectedMachineSources.length * selectedMachineTasks.length;
  const skippedMachinePairCount = Math.max(0, selectedMachinePairCount - machineRowsToAdd.length);
  const allFilteredLaborSourcesSelected = filteredLaborSourceOptions.length > 0 && filteredLaborSourceOptions.every(option => selectedLaborSourceKeys.has(option.key));
  const allFilteredLaborTasksSelected = filteredLaborTaskOptions.length > 0 && filteredLaborTaskOptions.every(option => selectedLaborTaskIds.has(option.key));
  const allFilteredMachineSourcesSelected = filteredMachineSourceOptions.length > 0 && filteredMachineSourceOptions.every(option => selectedMachineSourceKeys.has(option.key));
  const allFilteredMachineTasksSelected = filteredMachineTaskOptions.length > 0 && filteredMachineTaskOptions.every(option => selectedMachineTaskIds.has(option.key));

  useEffect(() => {
    setSelectedVolumeSourceKeys(prev => {
      const validKeys = new Set(volumeSelectableOptions.filter(option => !option.alreadyAdded).map(option => option.key));
      const next = new Set([...prev].filter(key => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [volumeSelectableOptions]);

  useEffect(() => {
    setSelectedLaborSourceKeys(prev => {
      const validKeys = new Set(laborSourceOptions.map(option => option.key));
      const next = new Set([...prev].filter(key => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
    setSelectedLaborTaskIds(prev => {
      const validKeys = new Set(taskQuickOptions.map(option => option.key));
      const next = new Set([...prev].filter(key => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [laborSourceOptions, taskQuickOptions]);

  useEffect(() => {
    setSelectedMachineSourceKeys(prev => {
      const validKeys = new Set(machineSourceOptions.map(option => option.key));
      const next = new Set([...prev].filter(key => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
    setSelectedMachineTaskIds(prev => {
      const validKeys = new Set(taskQuickOptions.map(option => option.key));
      const next = new Set([...prev].filter(key => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [machineSourceOptions, taskQuickOptions]);

  const createVolumeFromSource = (option: VolumeSourceOption): DailyLogVolume => {
    if (option.kind === 'workBoq' && option.workBoqItem) {
      const task = option.task || (option.workBoqItem.sourceTaskId ? taskById.get(option.workBoqItem.sourceTaskId) : undefined);
      return {
        taskId: task?.id || option.workBoqItem.sourceTaskId || undefined,
        taskName: task?.name || undefined,
        workBoqItemId: option.workBoqItem.id,
        workBoqItemName: option.workBoqItem.name,
        contractItemId: undefined,
        contractItemName: task?.name || option.workBoqItem.name,
        quantity: 0,
        unit: option.workBoqItem.unit || task?.fallbackUnit || option.unit || 'm2',
        attachments: [],
      };
    }

    const task = option.task;
    const matchedWorkBoq = task?.id ? workBoqByTaskId.get(task.id) : undefined;
    return {
      taskId: task?.id || undefined,
      taskName: task?.name || option.label,
      workBoqItemId: matchedWorkBoq?.id,
      workBoqItemName: matchedWorkBoq?.name,
      contractItemId: undefined,
      contractItemName: task?.name || option.label,
      quantity: 0,
      unit: matchedWorkBoq?.unit || task?.fallbackUnit || option.unit || 'm2',
      attachments: [],
    };
  };

  const toggleVolumeSource = (key: string) => {
    setSelectedVolumeSourceKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilteredVolumeSources = () => {
    setSelectedVolumeSourceKeys(prev => {
      const next = new Set(prev);
      selectableFilteredVolumeOptions.forEach(option => {
        if (allFilteredVolumeSelected) next.delete(option.key);
        else next.add(option.key);
      });
      return next;
    });
  };

  const addSelectedVolumeSources = () => {
    const selectedOptions = volumeSelectableOptions.filter(option => selectedVolumeSourceKeys.has(option.key) && !option.alreadyAdded);
    if (selectedOptions.length === 0) return;
    onVolumesChange([...volumes, ...selectedOptions.map(createVolumeFromSource)]);
    setSelectedVolumeSourceKeys(new Set());
    setVolumeSourceSearch('');
  };

  const toggleQuickPanel = (key: 'volumes' | 'labor' | 'machines') => {
    setQuickPanelOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSelection = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleFilteredSelection = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    keys: string[],
    allSelected: boolean,
  ) => {
    setter(prev => {
      const next = new Set(prev);
      keys.forEach(key => {
        if (allSelected) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  };

  const createLaborFromPair = (source: LaborSourceOption, task: ProjectTask): DailyLogLabor => {
    if (source.kind === 'catalog' && source.catalogItem) {
      return {
        laborType: source.catalogItem.name,
        catalogItemId: source.catalogItem.id,
        catalogCode: source.catalogItem.code,
        catalogName: source.catalogItem.name,
        groupName: source.catalogItem.groupName,
        partnerId: source.catalogItem.partnerId,
        partnerName: source.catalogItem.partnerName,
        taskId: task.id,
        taskName: task.name,
        count: 0,
        hours: 8,
      };
    }

    return {
      laborType: 'Tổ đội',
      groupName: source.partner?.name || source.label,
      partnerId: source.partner?.id,
      partnerName: source.partner?.name || source.label,
      taskId: task.id,
      taskName: task.name,
      count: 0,
      hours: 8,
    };
  };

  const createMachineFromPair = (source: MachineSourceOption, task: ProjectTask): DailyLogMachine => ({
    machineName: source.item.name,
    machineType: source.item.code || 'other',
    catalogItemId: source.item.id,
    catalogCode: source.item.code,
    catalogName: source.item.name,
    groupName: source.item.groupName,
    taskId: task.id,
    taskName: task.name,
    shifts: 1,
  });

  const addSelectedLaborPairs = () => {
    if (laborRowsToAdd.length === 0) return;
    const nextModes: Record<number, 'catalog' | 'partner'> = {};
    const nextRows = laborRowsToAdd.map(({ source, task }, offset) => {
      nextModes[laborDetails.length + offset] = source.kind;
      return createLaborFromPair(source, task);
    });
    setLaborModes(prev => ({ ...prev, ...nextModes }));
    onLaborChange([...laborDetails, ...nextRows]);
    setSelectedLaborSourceKeys(new Set());
    setSelectedLaborTaskIds(new Set());
    setLaborSourceSearch('');
    setLaborTaskSearch('');
  };

  const addSelectedMachinePairs = () => {
    if (machineRowsToAdd.length === 0) return;
    onMachinesChange([...machines, ...machineRowsToAdd.map(({ source, task }) => createMachineFromPair(source, task))]);
    setSelectedMachineSourceKeys(new Set());
    setSelectedMachineTaskIds(new Set());
    setMachineSourceSearch('');
    setMachineTaskSearch('');
  };

  return (
    <div className="border-t border-slate-100 pt-4">
      <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Chi tiết thi công</label>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${tab === t.key
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
          {volumeSourceOptions.length > 0 && (
            <div className="rounded-2xl border border-teal-100 bg-teal-50/50 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleQuickPanel('volumes')}
                className="w-full px-3 py-3 flex items-center justify-between gap-3 text-left hover:bg-teal-100/50 transition-colors"
              >
                <div>
                  <div className="text-[11px] font-black text-teal-800">Thêm nhanh nhiều hạng mục</div>
                  <div className="text-[10px] font-bold text-teal-600">
                    {quickPanelOpen.volumes ? 'Chọn checkbox các hạng mục cần ghi khối lượng.' : 'Mở để chọn nhiều hạng mục bằng checkbox.'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedVolumeSourceKeys.size > 0 && (
                    <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[9px] font-black text-white">{selectedVolumeSourceKeys.size}</span>
                  )}
                  {quickPanelOpen.volumes ? <ChevronUp size={16} className="text-teal-700" /> : <ChevronDown size={16} className="text-teal-700" />}
                </div>
              </button>
              {quickPanelOpen.volumes && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={toggleFilteredVolumeSources}
                      disabled={selectableFilteredVolumeOptions.length === 0}
                      className="px-2.5 py-1.5 rounded-lg border border-teal-200 bg-white text-[10px] font-black text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {allFilteredVolumeSelected ? 'Bỏ chọn kết quả' : 'Chọn kết quả'}
                    </button>
                    <button
                      type="button"
                      onClick={addSelectedVolumeSources}
                      disabled={selectedVolumeSourceKeys.size === 0}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-[10px] font-black hover:bg-teal-700 disabled:opacity-50"
                    >
                      Thêm {selectedVolumeSourceKeys.size > 0 ? selectedVolumeSourceKeys.size : ''}
                    </button>
                  </div>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-500" />
                    <input
                      value={volumeSourceSearch}
                      onChange={event => setVolumeSourceSearch(event.target.value)}
                      placeholder="Tìm theo mã WBS, tên hạng mục, BOQ..."
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-teal-100 bg-white text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-300"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-teal-100 bg-white">
                    {filteredVolumeSourceOptions.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x-0 divide-teal-50">
                        {filteredVolumeSourceOptions.map(option => (
                          <label
                            key={option.key}
                            className={`flex items-start gap-2 px-3 py-2.5 border-b border-teal-50 last:border-b-0 cursor-pointer transition-colors ${option.alreadyAdded
                                ? 'opacity-55 cursor-not-allowed bg-slate-50'
                                : selectedVolumeSourceKeys.has(option.key)
                                  ? 'bg-teal-50'
                                  : 'hover:bg-teal-50/70'
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedVolumeSourceKeys.has(option.key)}
                              disabled={option.alreadyAdded}
                              onChange={() => toggleVolumeSource(option.key)}
                              className="mt-0.5 accent-teal-600"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-black text-slate-700 truncate">{option.label}</div>
                              <div className="text-[10px] font-bold text-slate-400 truncate">{option.meta || 'Hạng mục thi công'}</div>
                            </div>
                            {option.alreadyAdded && (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-400">Đã có</span>
                            )}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-center text-[11px] font-bold text-slate-400">
                        Không tìm thấy hạng mục phù hợp.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
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
            const currentQty = Math.max(0, Number(v.quantity || 0));
            const rowProgressPercent = plannedQty > 0 ? Math.min(100, (currentQty / plannedQty) * 100) : 0;
            const cumulativeProgressPercent = plannedQty > 0 ? Math.min(100, ((verifiedQty + currentQty) / plannedQty) * 100) : 0;
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
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[,.]?[0-9]*"
                        placeholder="0"
                        value={volumeQuantityDrafts[i] ?? formatDecimalInput(v.quantity)}
                        disabled={hasQuantityLimit && remainingQty <= 0}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        onChange={e => {
                          const rawValue = e.target.value;
                          const inputQty = parseNonNegativeDecimal(rawValue);
                          setVolumeQuantityDrafts(prev => ({ ...prev, [i]: rawValue }));
                          if (inputQty === null) return;
                          const u = [...volumes];
                          const nextQty = hasQuantityLimit ? Math.min(inputQty, remainingQty) : inputQty;
                          u[i] = { ...v, quantity: nextQty };
                          onVolumesChange(u);
                          if (hasQuantityLimit && inputQty > remainingQty) {
                            setVolumeQuantityDrafts(prev => ({ ...prev, [i]: formatDecimalInput(nextQty) }));
                          }
                        }}
                        onBlur={() => {
                          setVolumeQuantityDrafts(prev => {
                            const next = { ...prev };
                            delete next[i];
                            return next;
                          });
                        }}
                      />
                      {hasQuantityLimit ? (
                        <div className={`mt-1 space-y-0.5 text-[10px] font-bold ${remainingQty <= 0 ? 'text-red-500' : 'text-amber-600'}`}>
                          <p>Tối đa được nhập {formatQuantity(remainingQty)} {v.unit || task?.fallbackUnit || workBoqItem?.unit || ''}; phần vượt phải tách thành phát sinh/đầu mục khác.</p>
                          <p>Quy đổi dòng này {formatPercent(rowProgressPercent)}%; lũy kế sau xác nhận {formatPercent(cumulativeProgressPercent)}%.</p>
                        </div>
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
          {laborSourceOptions.length > 0 && taskQuickOptions.length > 0 && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50/50 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleQuickPanel('labor')}
                className="w-full px-3 py-3 flex items-center justify-between gap-3 text-left hover:bg-blue-100/50 transition-colors"
              >
                <div>
                  <div className="text-[11px] font-black text-blue-800">Thêm nhanh nhân công theo công tác</div>
                  <div className="text-[10px] font-bold text-blue-600">
                    {quickPanelOpen.labor ? 'Chọn nhà thầu/tổ đội và công tác để tạo nhiều dòng.' : 'Mở để chọn 1 hoặc nhiều nhà thầu x nhiều công tác.'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedLaborPairCount > 0 && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-black text-white">{laborRowsToAdd.length}</span>
                  )}
                  {quickPanelOpen.labor ? <ChevronUp size={16} className="text-blue-700" /> : <ChevronDown size={16} className="text-blue-700" />}
                </div>
              </button>
              {quickPanelOpen.labor && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-blue-100 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-blue-50 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black text-blue-700 uppercase">Nhà thầu / tổ đội</div>
                        <button
                          type="button"
                          onClick={() => toggleFilteredSelection(
                            setSelectedLaborSourceKeys,
                            filteredLaborSourceOptions.map(option => option.key),
                            allFilteredLaborSourcesSelected,
                          )}
                          disabled={filteredLaborSourceOptions.length === 0}
                          className="text-[9px] font-black text-blue-600 hover:text-blue-800 disabled:opacity-40"
                        >
                          {allFilteredLaborSourcesSelected ? 'Bỏ chọn' : 'Chọn kết quả'}
                        </button>
                      </div>
                      <div className="relative m-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-400" />
                        <input
                          value={laborSourceSearch}
                          onChange={event => setLaborSourceSearch(event.target.value)}
                          placeholder="Tìm nhà thầu, tổ đội, danh mục..."
                          className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-blue-100 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {filteredLaborSourceOptions.length > 0 ? filteredLaborSourceOptions.map(option => (
                          <label key={option.key} className={`flex items-start gap-2 px-3 py-2 border-t border-blue-50 cursor-pointer ${selectedLaborSourceKeys.has(option.key) ? 'bg-blue-50' : 'hover:bg-blue-50/60'}`}>
                            <input
                              type="checkbox"
                              checked={selectedLaborSourceKeys.has(option.key)}
                              onChange={() => toggleSelection(setSelectedLaborSourceKeys, option.key)}
                              className="mt-0.5 accent-blue-600"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-700 truncate">{option.label}</div>
                              <div className="text-[10px] font-bold text-slate-400 truncate">{option.meta || 'Nguồn nhân công'}</div>
                            </div>
                          </label>
                        )) : (
                          <div className="px-3 py-4 text-center text-[11px] font-bold text-slate-400">Không tìm thấy nguồn nhân công.</div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-blue-50 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black text-blue-700 uppercase">Công tác</div>
                        <button
                          type="button"
                          onClick={() => toggleFilteredSelection(
                            setSelectedLaborTaskIds,
                            filteredLaborTaskOptions.map(option => option.key),
                            allFilteredLaborTasksSelected,
                          )}
                          disabled={filteredLaborTaskOptions.length === 0}
                          className="text-[9px] font-black text-blue-600 hover:text-blue-800 disabled:opacity-40"
                        >
                          {allFilteredLaborTasksSelected ? 'Bỏ chọn' : 'Chọn kết quả'}
                        </button>
                      </div>
                      <div className="relative m-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-400" />
                        <input
                          value={laborTaskSearch}
                          onChange={event => setLaborTaskSearch(event.target.value)}
                          placeholder="Tìm công tác..."
                          className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-blue-100 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {filteredLaborTaskOptions.length > 0 ? filteredLaborTaskOptions.map(option => (
                          <label key={option.key} className={`flex items-start gap-2 px-3 py-2 border-t border-blue-50 cursor-pointer ${selectedLaborTaskIds.has(option.key) ? 'bg-blue-50' : 'hover:bg-blue-50/60'}`}>
                            <input
                              type="checkbox"
                              checked={selectedLaborTaskIds.has(option.key)}
                              onChange={() => toggleSelection(setSelectedLaborTaskIds, option.key)}
                              className="mt-0.5 accent-blue-600"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-700 truncate">{option.label}</div>
                              <div className="text-[10px] font-bold text-slate-400 truncate">{option.meta || 'Công tác thi công'}</div>
                            </div>
                          </label>
                        )) : (
                          <div className="px-3 py-4 text-center text-[11px] font-bold text-slate-400">Không tìm thấy công tác.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-[10px] font-bold text-blue-600">
                      Đã chọn {selectedLaborSources.length} nguồn x {selectedLaborTasks.length} công tác.
                      {skippedLaborPairCount > 0 && <span className="text-slate-400"> Bỏ qua {skippedLaborPairCount} dòng đã có.</span>}
                    </div>
                    <button
                      type="button"
                      onClick={addSelectedLaborPairs}
                      disabled={laborRowsToAdd.length === 0}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-black hover:bg-blue-700 disabled:opacity-50"
                    >
                      Thêm {laborRowsToAdd.length > 0 ? laborRowsToAdd.length : ''} dòng nhân công
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
          {machineSourceOptions.length > 0 && taskQuickOptions.length > 0 && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50/50 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleQuickPanel('machines')}
                className="w-full px-3 py-3 flex items-center justify-between gap-3 text-left hover:bg-purple-100/50 transition-colors"
              >
                <div>
                  <div className="text-[11px] font-black text-purple-800">Thêm nhanh máy thi công theo công tác</div>
                  <div className="text-[10px] font-bold text-purple-600">
                    {quickPanelOpen.machines ? 'Chọn máy và công tác để tạo nhiều dòng.' : 'Mở để chọn 1 hoặc nhiều máy x nhiều công tác.'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedMachinePairCount > 0 && (
                    <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[9px] font-black text-white">{machineRowsToAdd.length}</span>
                  )}
                  {quickPanelOpen.machines ? <ChevronUp size={16} className="text-purple-700" /> : <ChevronDown size={16} className="text-purple-700" />}
                </div>
              </button>
              {quickPanelOpen.machines && (
                <div className="px-3 pb-3 space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-purple-100 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-purple-50 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black text-purple-700 uppercase">Máy thi công</div>
                        <button
                          type="button"
                          onClick={() => toggleFilteredSelection(
                            setSelectedMachineSourceKeys,
                            filteredMachineSourceOptions.map(option => option.key),
                            allFilteredMachineSourcesSelected,
                          )}
                          disabled={filteredMachineSourceOptions.length === 0}
                          className="text-[9px] font-black text-purple-600 hover:text-purple-800 disabled:opacity-40"
                        >
                          {allFilteredMachineSourcesSelected ? 'Bỏ chọn' : 'Chọn kết quả'}
                        </button>
                      </div>
                      <div className="relative m-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-400" />
                        <input
                          value={machineSourceSearch}
                          onChange={event => setMachineSourceSearch(event.target.value)}
                          placeholder="Tìm máy thi công..."
                          className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-purple-100 text-xs font-bold outline-none focus:ring-2 focus:ring-purple-200"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {filteredMachineSourceOptions.length > 0 ? filteredMachineSourceOptions.map(option => (
                          <label key={option.key} className={`flex items-start gap-2 px-3 py-2 border-t border-purple-50 cursor-pointer ${selectedMachineSourceKeys.has(option.key) ? 'bg-purple-50' : 'hover:bg-purple-50/60'}`}>
                            <input
                              type="checkbox"
                              checked={selectedMachineSourceKeys.has(option.key)}
                              onChange={() => toggleSelection(setSelectedMachineSourceKeys, option.key)}
                              className="mt-0.5 accent-purple-600"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-700 truncate">{option.label}</div>
                              <div className="text-[10px] font-bold text-slate-400 truncate">{option.meta || 'Máy thi công'}</div>
                            </div>
                          </label>
                        )) : (
                          <div className="px-3 py-4 text-center text-[11px] font-bold text-slate-400">Không tìm thấy máy thi công.</div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-purple-100 bg-white overflow-hidden">
                      <div className="px-3 py-2 border-b border-purple-50 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black text-purple-700 uppercase">Công tác</div>
                        <button
                          type="button"
                          onClick={() => toggleFilteredSelection(
                            setSelectedMachineTaskIds,
                            filteredMachineTaskOptions.map(option => option.key),
                            allFilteredMachineTasksSelected,
                          )}
                          disabled={filteredMachineTaskOptions.length === 0}
                          className="text-[9px] font-black text-purple-600 hover:text-purple-800 disabled:opacity-40"
                        >
                          {allFilteredMachineTasksSelected ? 'Bỏ chọn' : 'Chọn kết quả'}
                        </button>
                      </div>
                      <div className="relative m-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-400" />
                        <input
                          value={machineTaskSearch}
                          onChange={event => setMachineTaskSearch(event.target.value)}
                          placeholder="Tìm công tác..."
                          className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-purple-100 text-xs font-bold outline-none focus:ring-2 focus:ring-purple-200"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {filteredMachineTaskOptions.length > 0 ? filteredMachineTaskOptions.map(option => (
                          <label key={option.key} className={`flex items-start gap-2 px-3 py-2 border-t border-purple-50 cursor-pointer ${selectedMachineTaskIds.has(option.key) ? 'bg-purple-50' : 'hover:bg-purple-50/60'}`}>
                            <input
                              type="checkbox"
                              checked={selectedMachineTaskIds.has(option.key)}
                              onChange={() => toggleSelection(setSelectedMachineTaskIds, option.key)}
                              className="mt-0.5 accent-purple-600"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-700 truncate">{option.label}</div>
                              <div className="text-[10px] font-bold text-slate-400 truncate">{option.meta || 'Công tác thi công'}</div>
                            </div>
                          </label>
                        )) : (
                          <div className="px-3 py-4 text-center text-[11px] font-bold text-slate-400">Không tìm thấy công tác.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-[10px] font-bold text-purple-600">
                      Đã chọn {selectedMachineSources.length} máy x {selectedMachineTasks.length} công tác.
                      {skippedMachinePairCount > 0 && <span className="text-slate-400"> Bỏ qua {skippedMachinePairCount} dòng đã có.</span>}
                    </div>
                    <button
                      type="button"
                      onClick={addSelectedMachinePairs}
                      disabled={machineRowsToAdd.length === 0}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 disabled:opacity-50"
                    >
                      Thêm {machineRowsToAdd.length > 0 ? machineRowsToAdd.length : ''} dòng máy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
