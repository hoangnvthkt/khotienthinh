import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Construction,
  Edit2,
  Hammer,
  Layers,
  Loader2,
  PackageSearch,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  ContractCatalogStatus,
  ContractCostItem,
  ContractLaborCatalogItem,
  ContractMachineCatalogItem,
  ContractMaterialNormItem,
  ContractServiceCatalogItem,
  BusinessPartner,
  InventoryItem,
} from '../../types';
import {
  contractCatalogInventoryService,
  contractCostItemService,
  contractLaborCatalogService,
  contractMachineCatalogService,
  contractMaterialNormService,
  contractServiceCatalogService,
} from '../../lib/contractMetadataService';
import { partnerService } from '../../lib/partnerService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

type CatalogTab = 'services' | 'labor' | 'machines' | 'costItems' | 'materialNorms';
type SimpleCatalogItem = ContractServiceCatalogItem | ContractLaborCatalogItem | ContractMachineCatalogItem;

const tabs: Array<{ key: CatalogTab; label: string; icon: React.ReactNode }> = [
  { key: 'services', label: 'Dịch vụ', icon: <BriefcaseBusiness size={14} /> },
  { key: 'labor', label: 'Nhân công', icon: <Hammer size={14} /> },
  { key: 'machines', label: 'Máy thi công', icon: <Construction size={14} /> },
  { key: 'costItems', label: 'Khoản mục chi phí', icon: <Layers size={14} /> },
  { key: 'materialNorms', label: 'Định mức vật liệu', icon: <PackageSearch size={14} /> },
];

const statusLabels: Record<ContractCatalogStatus, string> = {
  active: 'Hoạt động',
  inactive: 'Ngưng dùng',
};

const emptyService = (): ContractServiceCatalogItem => ({
  id: crypto.randomUUID(),
  code: '',
  name: '',
  groupName: '',
  unit: '',
  unitPrice: 0,
  status: 'active',
  note: '',
});

const emptyLabor = (): ContractLaborCatalogItem => ({
  id: crypto.randomUUID(),
  code: '',
  name: '',
  groupName: '',
  unit: '',
  status: 'active',
  note: '',
});

const emptyMachine = (): ContractMachineCatalogItem => ({
  id: crypto.randomUUID(),
  code: '',
  name: '',
  groupName: '',
  unit: '',
  status: 'active',
  note: '',
});

const emptyMaterialNorm = (): ContractMaterialNormItem => ({
  id: crypto.randomUUID(),
  workCode: '',
  materialItemId: '',
  materialSku: '',
  materialName: '',
  unit: '',
  wastePercent: 0,
  norm: 0,
  note: '',
  status: 'active',
});

const emptyCostItem = (parentId: string | null = null, sortOrder = 0): ContractCostItem => ({
  id: crypto.randomUUID(),
  parentId,
  symbol: '',
  name: '',
  costType: '',
  description: '',
  status: 'active',
  sortOrder,
});

const fmtMoney = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));

interface CostTreeRow {
  item: ContractCostItem;
  depth: number;
  index: string;
  hasChildren: boolean;
}

const sortCostItems = (rows: ContractCostItem[]) =>
  [...rows].sort((a, b) =>
    (a.sortOrder || 0) - (b.sortOrder || 0)
    || a.symbol.localeCompare(b.symbol, 'vi')
    || a.name.localeCompare(b.name, 'vi'));

const buildCostTreeRows = (
  items: ContractCostItem[],
  expandedIds: Set<string>,
  query: string,
): CostTreeRow[] => {
  const rows: CostTreeRow[] = [];
  const keyword = query.trim().toLowerCase();
  const byParent = new Map<string, ContractCostItem[]>();
  items.forEach(item => {
    const key = item.parentId || 'root';
    byParent.set(key, [...(byParent.get(key) || []), item]);
  });
  byParent.forEach((children, key) => byParent.set(key, sortCostItems(children)));

  const matches = (item: ContractCostItem) =>
    !keyword || [item.symbol, item.name, item.costType, item.description]
      .some(value => (value || '').toLowerCase().includes(keyword));

  const hasMatchingDescendant = (itemId: string): boolean =>
    (byParent.get(itemId) || []).some(child => matches(child) || hasMatchingDescendant(child.id));

  const visit = (parentId: string | null, depth: number, prefix: string, forceShowChildren = false) => {
    (byParent.get(parentId || 'root') || []).forEach((item, index) => {
      const displayIndex = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      const hasChildren = (byParent.get(item.id) || []).length > 0;
      const childMatch = hasMatchingDescendant(item.id);
      const selfMatch = matches(item);
      if (!keyword || selfMatch || childMatch || forceShowChildren) {
        rows.push({ item, depth, index: displayIndex, hasChildren });
        const shouldExpand = keyword ? (selfMatch || childMatch || forceShowChildren) : expandedIds.has(item.id);
        if (hasChildren && shouldExpand) visit(item.id, depth + 1, displayIndex, keyword ? (selfMatch || forceShowChildren) : false);
      }
    });
  };

  visit(null, 0, '');
  return rows;
};

const getDescendantCostItemIds = (items: ContractCostItem[], itemId: string): Set<string> => {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    items.filter(item => item.parentId === parentId).forEach(child => {
      descendants.add(child.id);
      visit(child.id);
    });
  };
  visit(itemId);
  return descendants;
};

const buildCostParentOptions = (items: ContractCostItem[], editingId?: string) => {
  const excluded = editingId ? getDescendantCostItemIds(items, editingId) : new Set<string>();
  if (editingId) excluded.add(editingId);
  return buildCostTreeRows(items.filter(item => !excluded.has(item.id)), new Set(items.map(item => item.id)), '')
    .map(row => ({ item: row.item, index: row.index, depth: row.depth }));
};

const ContractCatalogs: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu danh mục',
    fallbackError: 'Không thể lưu dữ liệu danh mục hợp đồng.',
    logScope: 'contractCatalogs.save',
  });
  const [activeTab, setActiveTab] = useState<CatalogTab>('services');
  const [services, setServices] = useState<ContractServiceCatalogItem[]>([]);
  const [labor, setLabor] = useState<ContractLaborCatalogItem[]>([]);
  const [machines, setMachines] = useState<ContractMachineCatalogItem[]>([]);
  const [materialNorms, setMaterialNorms] = useState<ContractMaterialNormItem[]>([]);
  const [costItems, setCostItems] = useState<ContractCostItem[]>([]);
  const [materials, setMaterials] = useState<InventoryItem[]>([]);
  const [contractorPartners, setContractorPartners] = useState<BusinessPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [simpleForm, setSimpleForm] = useState<SimpleCatalogItem | null>(null);
  const [normForm, setNormForm] = useState<ContractMaterialNormItem | null>(null);
  const [costForm, setCostForm] = useState<ContractCostItem | null>(null);
  const [expandedCostIds, setExpandedCostIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [serviceRows, laborRows, machineRows, normRows, costRows, materialRows, partnerRows] = await Promise.all([
        contractServiceCatalogService.list(),
        contractLaborCatalogService.list(),
        contractMachineCatalogService.list(),
        contractMaterialNormService.list(),
        contractCostItemService.list(),
        contractCatalogInventoryService.listMaterials(),
        partnerService.list(),
      ]);
      setServices(serviceRows);
      setLabor(laborRows);
      setMachines(machineRows);
      setMaterialNorms(normRows);
      setCostItems(costRows);
      setMaterials(materialRows);
      setContractorPartners(partnerRows);
    } catch (error) {
      logApiError('contractCatalogs.load', error);
      toast.error('Không thể tải danh mục', getApiErrorMessage(error, 'Không thể tải dữ liệu danh mục hợp đồng.'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const counts = {
    services: services.length,
    labor: labor.length,
    machines: machines.length,
    materialNorms: materialNorms.length,
    costItems: costItems.length,
  };

  const groupOptions = useMemo(() => {
    const source = activeTab === 'services' ? services : activeTab === 'labor' ? labor : activeTab === 'machines' ? machines : [];
    const groups = source.map(item => item.groupName).filter(Boolean) as string[];
    if (activeTab === 'labor') groups.push(...contractorPartners.map(partner => partner.name));
    return Array.from(new Set(groups)).sort();
  }, [activeTab, services, labor, machines, contractorPartners]);

  const openCreate = () => {
    if (activeTab === 'services') setSimpleForm(emptyService());
    if (activeTab === 'labor') setSimpleForm(emptyLabor());
    if (activeTab === 'machines') setSimpleForm(emptyMachine());
    if (activeTab === 'materialNorms') setNormForm(emptyMaterialNorm());
    if (activeTab === 'costItems') {
      setCostForm(emptyCostItem(null, costItems.filter(item => !item.parentId).length));
    }
  };

  const saveSimple = async () => {
    if (!simpleForm) return;
    if (!simpleForm.code.trim() || !simpleForm.name.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập mã và tên danh mục.');
      return;
    }
    await run(async () => {
      if ('unitPrice' in simpleForm) await contractServiceCatalogService.upsert(simpleForm);
      else if (activeTab === 'labor') await contractLaborCatalogService.upsert(simpleForm as ContractLaborCatalogItem);
      else await contractMachineCatalogService.upsert(simpleForm as ContractMachineCatalogItem);
      setSimpleForm(null);
      await load();
    }, { successTitle: 'Đã lưu danh mục' });
  };

  const saveMaterialNorm = async () => {
    if (!normForm) return;
    if (!normForm.workCode.trim() || !normForm.materialName.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập mã công tác và chọn vật liệu.');
      return;
    }
    await run(async () => {
      await contractMaterialNormService.upsert(normForm);
      setNormForm(null);
      await load();
    }, { successTitle: 'Đã lưu định mức vật liệu' });
  };

  const removeSimple = async (item: SimpleCatalogItem) => {
    const ok = await confirm({ title: 'Xoá danh mục', targetName: `${item.code} - ${item.name}` });
    if (!ok) return;
    await run(async () => {
      if ('unitPrice' in item) await contractServiceCatalogService.remove(item.id);
      else if (activeTab === 'labor') await contractLaborCatalogService.remove(item.id);
      else await contractMachineCatalogService.remove(item.id);
      await load();
    }, { successTitle: 'Đã xoá danh mục', errorTitle: 'Không thể xoá danh mục' });
  };

  const removeNorm = async (item: ContractMaterialNormItem) => {
    const ok = await confirm({ title: 'Xoá định mức vật liệu', targetName: `${item.workCode} - ${item.materialName}` });
    if (!ok) return;
    await run(async () => {
      await contractMaterialNormService.remove(item.id);
      await load();
    }, { successTitle: 'Đã xoá định mức vật liệu', errorTitle: 'Không thể xoá định mức vật liệu' });
  };

  const openCostChild = (item: ContractCostItem) => {
    setExpandedCostIds(prev => new Set(prev).add(item.id));
    setCostForm(emptyCostItem(item.id, costItems.filter(child => child.parentId === item.id).length));
  };

  const saveCostItem = async (closeAfterSave: boolean) => {
    if (!costForm) return;
    if (!costForm.symbol.trim() || !costForm.name.trim()) {
      toast.warning('Thiếu thông tin', 'Vui lòng nhập ký hiệu và khoản mục chi phí.');
      return;
    }
    if (costForm.parentId && getDescendantCostItemIds(costItems, costForm.id).has(costForm.parentId)) {
      toast.warning('Khoản mục cha không hợp lệ', 'Không thể chọn khoản mục con làm cha.');
      return;
    }
    const parentId = costForm.parentId || null;
    await run(async () => {
      await contractCostItemService.upsert({ ...costForm, parentId });
      await load();
      if (parentId) setExpandedCostIds(prev => new Set(prev).add(parentId));
      if (closeAfterSave) {
        setCostForm(null);
      } else {
        const nextSortOrder = costItems.filter(item => (item.parentId || null) === parentId && item.id !== costForm.id).length + 1;
        setCostForm(emptyCostItem(parentId, nextSortOrder));
      }
    }, {
      successTitle: 'Đã lưu khoản mục chi phí',
      errorTitle: 'Không thể lưu khoản mục chi phí',
      fallbackError: 'Không thể lưu khoản mục chi phí.',
    });
  };

  const removeCostItem = async (item: ContractCostItem) => {
    if (costItems.some(child => child.parentId === item.id)) {
      toast.error('Không thể xoá khoản mục', 'Khoản mục này đang có khoản mục con. Vui lòng xoá hoặc chuyển các khoản mục con trước.');
      return;
    }
    const ok = await confirm({ title: 'Xoá khoản mục chi phí', targetName: `${item.symbol} - ${item.name}` });
    if (!ok) return;
    await run(async () => {
      await contractCostItemService.remove(item.id);
      await load();
    }, {
      successTitle: 'Đã xoá khoản mục chi phí',
      errorTitle: 'Không thể xoá khoản mục chi phí',
      fallbackError: 'Không thể xoá khoản mục chi phí.',
    });
  };

  const selectMaterial = (materialId: string) => {
    const material = materials.find(item => item.id === materialId);
    setNormForm(prev => prev ? {
      ...prev,
      materialItemId: materialId,
      materialSku: material?.sku || '',
      materialName: material?.name || '',
      unit: material?.unit || prev.unit || '',
    } : prev);
  };

  const filteredSimple = (rows: SimpleCatalogItem[]) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter(item => [item.code, item.name, item.groupName, item.unit].some(value => (value || '').toLowerCase().includes(keyword)));
  };

  const filteredNorms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return materialNorms;
    return materialNorms.filter(item => [item.workCode, item.materialSku, item.materialName, item.unit, item.note].some(value => (value || '').toLowerCase().includes(keyword)));
  }, [materialNorms, query]);

  const costRows = useMemo(
    () => buildCostTreeRows(costItems, expandedCostIds, query),
    [costItems, expandedCostIds, query],
  );

  const visibleExpandedCostIds = useMemo(
    () => query.trim() ? new Set(costItems.map(item => item.id)) : expandedCostIds,
    [costItems, expandedCostIds, query],
  );

  const costTypeOptions = useMemo(
    () => Array.from(new Set(costItems.map(item => item.costType).filter(Boolean) as string[])).sort(),
    [costItems],
  );

  const toggleCostExpanded = (id: string) => {
    setExpandedCostIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-800 dark:text-white">Danh mục</h2>
          <p className="text-xs font-bold text-slate-400">Metadata dùng chung cho hợp đồng, BOQ và định mức.</p>
        </div>
        <button
          onClick={openCreate}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-md disabled:opacity-50"
        >
          <Plus size={15} /> {activeTab === 'costItems' ? 'Khoản mục' : 'Thêm mới'}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 pt-3 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setQuery(''); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'border-emerald-500 text-emerald-600'
                  : 'border-transparent text-slate-400 hover:text-slate-700'
              }`}
            >
              {tab.icon} {tab.label} <span className="text-[10px]">({counts[tab.key]})</span>
            </button>
          ))}
        </div>

        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="relative max-w-xl">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Tìm kiếm danh mục..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm font-bold text-slate-400">
            <Loader2 size={16} className="inline animate-spin mr-2" />Đang tải danh mục...
          </div>
        ) : activeTab === 'services' ? (
          <SimpleCatalogTable rows={filteredSimple(services)} showPrice onEdit={setSimpleForm} onDelete={removeSimple} />
        ) : activeTab === 'labor' ? (
          <SimpleCatalogTable rows={filteredSimple(labor)} onEdit={setSimpleForm} onDelete={removeSimple} />
        ) : activeTab === 'machines' ? (
          <SimpleCatalogTable rows={filteredSimple(machines)} onEdit={setSimpleForm} onDelete={removeSimple} />
        ) : activeTab === 'materialNorms' ? (
          <MaterialNormTable rows={filteredNorms} onEdit={setNormForm} onDelete={removeNorm} />
        ) : (
          <CostItemTreeTable
            rows={costRows}
            expandedIds={visibleExpandedCostIds}
            onToggle={toggleCostExpanded}
            onAddChild={openCostChild}
            onEdit={setCostForm}
            onDelete={removeCostItem}
          />
        )}
      </div>

      {simpleForm && (
        <SimpleCatalogModal
          item={simpleForm}
          title={'unitPrice' in simpleForm ? 'Tạo dịch vụ' : activeTab === 'labor' ? 'Tạo nhân công' : 'Tạo máy thi công'}
          nameLabel={'unitPrice' in simpleForm ? 'Tên dịch vụ *' : activeTab === 'labor' ? 'Tên nhân công *' : 'Tên máy thi công *'}
          codeLabel={'unitPrice' in simpleForm ? 'Mã dịch vụ' : activeTab === 'labor' ? 'Mã nhân công' : 'Mã máy thi công'}
          groupLabel={'unitPrice' in simpleForm ? 'Nhóm dịch vụ' : activeTab === 'labor' ? 'Nhóm nhân công' : 'Nhóm máy thi công'}
          groupOptions={groupOptions}
          contractorPartners={activeTab === 'labor' ? contractorPartners : []}
          allowContractorGroup={activeTab === 'labor'}
          onChange={setSimpleForm}
          onClose={() => setSimpleForm(null)}
          onSave={saveSimple}
          saving={saving}
        />
      )}

      {normForm && (
        <MaterialNormModal
          item={normForm}
          materials={materials}
          onSelectMaterial={selectMaterial}
          onChange={setNormForm}
          onClose={() => setNormForm(null)}
          onSave={saveMaterialNorm}
          saving={saving}
        />
      )}

      {costForm && (
        <CostItemModal
          item={costForm}
          allItems={costItems}
          costTypeOptions={costTypeOptions}
          saving={saving}
          onChange={setCostForm}
          onClose={() => setCostForm(null)}
          onSaveAndClose={() => saveCostItem(true)}
          onSaveAndContinue={() => saveCostItem(false)}
        />
      )}
    </div>
  );
};

const SimpleCatalogTable: React.FC<{
  rows: SimpleCatalogItem[];
  showPrice?: boolean;
  onEdit: (item: SimpleCatalogItem) => void;
  onDelete: (item: SimpleCatalogItem) => void;
}> = ({ rows, showPrice, onEdit, onDelete }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase text-slate-400 font-black">
        <tr>
          <th className="px-4 py-3 text-left">Mã</th>
          <th className="px-4 py-3 text-left">Tên</th>
          <th className="px-4 py-3 text-left">Nhóm</th>
          <th className="px-4 py-3 text-left">Đơn vị</th>
          {showPrice && <th className="px-4 py-3 text-right">Đơn giá</th>}
          <th className="px-4 py-3 text-center">Trạng thái</th>
          <th className="px-4 py-3 text-right">Thao tác</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.length === 0 ? (
          <tr><td colSpan={showPrice ? 7 : 6} className="py-12 text-center text-xs font-bold text-slate-400">Chưa có dữ liệu</td></tr>
        ) : rows.map(item => (
          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <td className="px-4 py-3 font-mono font-black text-emerald-600">{item.code}</td>
            <td className="px-4 py-3 font-bold text-slate-800 dark:text-white">{item.name}</td>
            <td className="px-4 py-3 text-slate-500">{item.groupName || '-'}</td>
            <td className="px-4 py-3 text-slate-500">{item.unit || '-'}</td>
            {showPrice && <td className="px-4 py-3 text-right font-black text-slate-800">{fmtMoney((item as ContractServiceCatalogItem).unitPrice || 0)}</td>}
            <td className="px-4 py-3 text-center">
              <StatusBadge status={item.status} />
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"><Edit2 size={14} /></button>
                <button onClick={() => onDelete(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MaterialNormTable: React.FC<{
  rows: ContractMaterialNormItem[];
  onEdit: (item: ContractMaterialNormItem) => void;
  onDelete: (item: ContractMaterialNormItem) => void;
}> = ({ rows, onEdit, onDelete }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase text-slate-400 font-black">
        <tr>
          <th className="px-4 py-3 text-left">Mã công tác</th>
          <th className="px-4 py-3 text-left">Vật liệu</th>
          <th className="px-4 py-3 text-left">Đơn vị</th>
          <th className="px-4 py-3 text-right">% Hao hụt</th>
          <th className="px-4 py-3 text-right">Định mức</th>
          <th className="px-4 py-3 text-left">Ghi chú</th>
          <th className="px-4 py-3 text-center">Trạng thái</th>
          <th className="px-4 py-3 text-right">Thao tác</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.length === 0 ? (
          <tr><td colSpan={8} className="py-12 text-center text-xs font-bold text-slate-400">Chưa có định mức vật liệu</td></tr>
        ) : rows.map(item => (
          <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <td className="px-4 py-3 font-mono font-black text-emerald-600">{item.workCode}</td>
            <td className="px-4 py-3">
              <div className="font-bold text-slate-800 dark:text-white">{item.materialName}</div>
              <div className="text-xs text-slate-400">{item.materialSku || '-'}</div>
            </td>
            <td className="px-4 py-3 text-slate-500">{item.unit || '-'}</td>
            <td className="px-4 py-3 text-right font-bold text-slate-700">{item.wastePercent || 0}</td>
            <td className="px-4 py-3 text-right font-bold text-slate-700">{item.norm || 0}</td>
            <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{item.note || '-'}</td>
            <td className="px-4 py-3 text-center"><StatusBadge status={item.status} /></td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"><Edit2 size={14} /></button>
                <button onClick={() => onDelete(item)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const CostItemTreeTable: React.FC<{
  rows: CostTreeRow[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onAddChild: (item: ContractCostItem) => void;
  onEdit: (item: ContractCostItem) => void;
  onDelete: (item: ContractCostItem) => void;
}> = ({ rows, expandedIds, onToggle, onAddChild, onEdit, onDelete }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase text-slate-400 font-black">
        <tr>
          <th className="px-4 py-3 text-left w-20">STT</th>
          <th className="px-4 py-3 text-left w-32">Ký hiệu</th>
          <th className="px-3 py-3 text-center w-14">Thêm</th>
          <th className="px-4 py-3 text-left min-w-[320px]">Khoản mục chi phí</th>
          <th className="px-4 py-3 text-left min-w-[260px]">Diễn giải</th>
          <th className="px-4 py-3 text-center w-32">Trạng thái</th>
          <th className="px-4 py-3 text-right w-28">Thao tác</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="py-12 text-center text-xs font-bold text-slate-400">Chưa có khoản mục chi phí</td></tr>
        ) : rows.map(row => (
          <tr key={row.item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
            <td className="px-4 py-3 font-mono font-bold text-slate-500">{row.index}</td>
            <td className="px-4 py-3 font-mono font-black text-emerald-600">{row.item.symbol}</td>
            <td className="px-3 py-3 text-center">
              <button
                onClick={() => onAddChild(row.item)}
                title="Thêm khoản mục con"
                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              >
                <Plus size={14} />
              </button>
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 18 }}>
                {row.hasChildren ? (
                  <button
                    onClick={() => onToggle(row.item.id)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {expandedIds.has(row.item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="w-6" />
                )}
                <div>
                  <div className="font-bold text-slate-800 dark:text-white">{row.item.name}</div>
                  {row.item.costType && <div className="text-xs font-bold text-slate-400">Loại: {row.item.costType}</div>}
                </div>
              </div>
            </td>
            <td className="px-4 py-3 text-slate-500 max-w-sm truncate">{row.item.description || '-'}</td>
            <td className="px-4 py-3 text-center"><StatusBadge status={row.item.status} /></td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => onEdit(row.item)} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"><Edit2 size={14} /></button>
                <button onClick={() => onDelete(row.item)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const StatusBadge: React.FC<{ status: ContractCatalogStatus }> = ({ status }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
    status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
  }`}>
    {statusLabels[status]}
  </span>
);

const partnerClassLabel: Record<string, string> = {
  owner: 'Chủ đầu tư',
  contractor: 'Nhà thầu',
  supplier: 'Nhà cung cấp',
};

const describePartner = (partner: BusinessPartner) =>
  (partner.classifications || []).map(value => partnerClassLabel[value] || value).join(', ') || 'Đối tác';

const ContractorGroupPicker: React.FC<{
  value: string;
  partners: BusinessPartner[];
  groupOptions: string[];
  onChange: (value: string, partner?: BusinessPartner) => void;
}> = ({ value, partners, groupOptions, onChange }) => {
  const [open, setOpen] = useState(false);
  const keyword = value.trim().toLowerCase();
  const options = useMemo(() => {
    const partnerOptions = partners.map(partner => ({
      key: `partner-${partner.id}`,
      label: partner.name,
      meta: [partner.code, partner.phone, describePartner(partner)].filter(Boolean).join(' • '),
      partner,
    }));
    const customOptions = groupOptions
      .filter(group => !partners.some(partner => partner.name === group))
      .map(group => ({
        key: `group-${group}`,
        label: group,
        meta: 'Nhóm đã khai báo',
        partner: undefined,
      }));
    const merged = [...partnerOptions, ...customOptions];
    if (!keyword) return merged.slice(0, 8);
    return merged
      .filter(option => `${option.label} ${option.meta}`.toLowerCase().includes(keyword))
      .slice(0, 8);
  }, [groupOptions, keyword, partners]);

  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nhóm nhân công</span>
      <div className="relative">
        <input
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={event => {
            onChange(event.target.value);
            setOpen(true);
          }}
          placeholder="Gõ để tìm NCC/thầu phụ hoặc nhập tổ đội"
          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
        {open && options.length > 0 && (
          <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:bg-slate-900 dark:border-slate-700">
            {options.map(option => (
              <button
                key={option.key}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onChange(option.label, option.partner);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-emerald-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800 last:border-b-0"
              >
                <div className="font-bold text-slate-700 dark:text-white truncate">{option.label}</div>
                <div className="text-[10px] text-slate-400 truncate">{option.meta}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="mt-1 block text-[10px] font-medium text-slate-400">Có thể chọn từ toàn bộ Danh sách HĐ đối tác hoặc nhập tự do.</span>
    </label>
  );
};

const SimpleCatalogModal: React.FC<{
  title: string;
  codeLabel: string;
  nameLabel: string;
  groupLabel: string;
  item: SimpleCatalogItem;
  groupOptions: string[];
  contractorPartners?: BusinessPartner[];
  allowContractorGroup?: boolean;
  saving: boolean;
  onChange: (item: SimpleCatalogItem) => void;
  onClose: () => void;
  onSave: () => void;
}> = ({ title, codeLabel, nameLabel, groupLabel, item, groupOptions, contractorPartners = [], allowContractorGroup = false, saving, onChange, onClose, onSave }) => {
  const changeGroup = (value: string, partner?: BusinessPartner) => {
    onChange({
      ...item,
      groupName: value,
      partnerId: partner?.id,
      partnerName: partner?.name,
    } as SimpleCatalogItem);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <ModalHeader title={title} onClose={onClose} />
        <div className="p-5 space-y-4">
          <Field label={codeLabel} value={item.code} onChange={value => onChange({ ...item, code: value })} placeholder={codeLabel} />
          <Field label={nameLabel} value={item.name} onChange={value => onChange({ ...item, name: value })} placeholder={nameLabel.replace(' *', '')} />
          {allowContractorGroup ? (
            <ContractorGroupPicker
              value={item.groupName || ''}
              partners={contractorPartners}
              groupOptions={groupOptions}
              onChange={changeGroup}
            />
          ) : (
            <>
              <Field label={groupLabel} value={item.groupName || ''} onChange={value => onChange({ ...item, groupName: value })} placeholder={`Chọn ${groupLabel.toLowerCase()}`} listId="contract-catalog-groups" />
              <datalist id="contract-catalog-groups">
                {groupOptions.map(group => <option key={group} value={group} />)}
              </datalist>
            </>
          )}
          <Field label="Đơn vị" value={item.unit || ''} onChange={value => onChange({ ...item, unit: value })} placeholder="Đơn vị" />
          {'unitPrice' in item && (
            <Field label="Đơn giá" type="number" value={String(item.unitPrice || 0)} onChange={value => onChange({ ...item, unitPrice: Number(value) } as SimpleCatalogItem)} placeholder="Đơn giá" />
          )}
          <SelectField label="Trạng thái" value={item.status} onChange={value => onChange({ ...item, status: value as ContractCatalogStatus })}>
            <option value="active">Hoạt động</option>
            <option value="inactive">Ngưng dùng</option>
          </SelectField>
        </div>
        <ModalFooter saving={saving} onClose={onClose} onSave={onSave} />
      </div>
    </div>
  );
};

const MaterialNormModal: React.FC<{
  item: ContractMaterialNormItem;
  materials: InventoryItem[];
  saving: boolean;
  onSelectMaterial: (materialId: string) => void;
  onChange: (item: ContractMaterialNormItem) => void;
  onClose: () => void;
  onSave: () => void;
}> = ({ item, materials, saving, onSelectMaterial, onChange, onClose, onSave }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
    <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
      <ModalHeader title="Thêm định mức vật liệu" onClose={onClose} />
      <div className="p-5 space-y-4">
        <Field label="Mã công tác *" value={item.workCode} onChange={value => onChange({ ...item, workCode: value })} placeholder="Nhập mã công tác" />
        <SelectField label="Vật liệu *" value={item.materialItemId || ''} onChange={onSelectMaterial}>
          <option value="">Chọn vật liệu</option>
          {materials.map(material => <option key={material.id} value={material.id}>{material.sku} - {material.name}</option>)}
        </SelectField>
        {!item.materialItemId && (
          <Field label="Tên vật liệu" value={item.materialName} onChange={value => onChange({ ...item, materialName: value })} placeholder="Nhập tên vật liệu nếu chưa có trong WMS" />
        )}
        <Field label="Đơn vị" value={item.unit || ''} onChange={value => onChange({ ...item, unit: value })} placeholder="Chọn đơn vị" />
        <Field label="% Hao hụt" type="number" value={String(item.wastePercent || 0)} onChange={value => onChange({ ...item, wastePercent: Number(value) })} />
        <Field label="Định mức" type="number" value={String(item.norm || 0)} onChange={value => onChange({ ...item, norm: Number(value) })} />
        <label className="block">
          <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Ghi chú</span>
          <textarea
            rows={3}
            value={item.note || ''}
            onChange={event => onChange({ ...item, note: event.target.value })}
            placeholder="Nhập ghi chú"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>
      </div>
      <ModalFooter saving={saving} onClose={onClose} onSave={onSave} />
    </div>
  </div>
);

const CostItemModal: React.FC<{
  item: ContractCostItem;
  allItems: ContractCostItem[];
  costTypeOptions: string[];
  saving: boolean;
  onChange: (item: ContractCostItem) => void;
  onClose: () => void;
  onSaveAndClose: () => void;
  onSaveAndContinue: () => void;
}> = ({ item, allItems, costTypeOptions, saving, onChange, onClose, onSaveAndClose, onSaveAndContinue }) => {
  const parentOptions = buildCostParentOptions(allItems, item.id);
  const typeListId = `contract-cost-types-${item.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <ModalHeader title={item.createdAt ? 'Sửa khoản mục chi phí' : 'Thêm khoản mục chi phí'} onClose={onClose} />
        <div className="p-5 space-y-4">
          <Field label="Ký hiệu *" value={item.symbol} onChange={value => onChange({ ...item, symbol: value })} placeholder="Nhập ký hiệu" />
          <Field label="Khoản mục chi phí *" value={item.name} onChange={value => onChange({ ...item, name: value })} placeholder="Nhập khoản mục chi phí" />
          <SelectField label="Khoản mục chi phí cha" value={item.parentId || ''} onChange={value => onChange({ ...item, parentId: value || null })}>
            <option value="">Không có - cấp gốc</option>
            {parentOptions.map(option => (
              <option key={option.item.id} value={option.item.id}>
                {`${'-- '.repeat(option.depth)}${option.index}. ${option.item.symbol} - ${option.item.name}`}
              </option>
            ))}
          </SelectField>
          <Field label="Loại chi phí" value={item.costType || ''} onChange={value => onChange({ ...item, costType: value })} placeholder="Chọn hoặc nhập loại chi phí" listId={typeListId} />
          <datalist id={typeListId}>
            {costTypeOptions.map(option => <option key={option} value={option} />)}
          </datalist>
          <label className="block">
            <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Diễn giải</span>
            <textarea
              rows={4}
              value={item.description || ''}
              onChange={event => onChange({ ...item, description: event.target.value })}
              placeholder="Nhập diễn giải"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <SelectField label="Trạng thái" value={item.status} onChange={value => onChange({ ...item, status: value as ContractCatalogStatus })}>
            <option value="active">Hoạt động</option>
            <option value="inactive">Ngưng dùng</option>
          </SelectField>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="sm:w-32 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50"
          >
            Đóng
          </button>
          <button
            onClick={onSaveAndClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu và đóng
          </button>
          <button
            onClick={onSaveAndContinue}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Lưu và thêm tiếp
          </button>
        </div>
      </div>
    </div>
  );
};

const ModalHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => (
  <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
    <h3 className="font-black text-slate-800 dark:text-white">{title}</h3>
    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
  </div>
);

const ModalFooter: React.FC<{ saving: boolean; onClose: () => void; onSave: () => void }> = ({ saving, onClose, onSave }) => (
  <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300">
      Đóng
    </button>
    <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
      {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu
    </button>
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  listId?: string;
}> = ({ label, value, onChange, placeholder, type = 'text', listId }) => (
  <label className="block">
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <input
      type={type}
      list={listId}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
    />
  </label>
);

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">{label}</span>
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
    >
      {children}
    </select>
  </label>
);

export default ContractCatalogs;
