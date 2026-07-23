import {
  ContractCostItem,
  ProjectCostClassificationStatus,
  ProjectCostCategory,
  ProjectTransaction,
} from '../types';

export interface ContractCostItemOption {
  item: ContractCostItem;
  id: string;
  symbol: string;
  name: string;
  depth: number;
  displayIndex: string;
  label: string;
}

interface BuildOptions {
  activeOnly?: boolean;
}

const normalizeLookup = (value: unknown) => String(value || '').trim().toLowerCase();

const sortCostItems = (rows: ContractCostItem[]) =>
  [...rows].sort((a, b) =>
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    || String(a.symbol || '').localeCompare(String(b.symbol || ''), 'vi')
    || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));

export const buildContractCostItemOptions = (
  items: ContractCostItem[],
  options: BuildOptions = {},
): ContractCostItemOption[] => {
  const activeOnly = options.activeOnly ?? true;
  const rows = activeOnly ? items.filter(item => item.status === 'active') : [...items];
  const byParent = new Map<string, ContractCostItem[]>();
  rows.forEach(item => {
    const key = item.parentId || 'root';
    byParent.set(key, [...(byParent.get(key) || []), item]);
  });
  byParent.forEach((children, key) => byParent.set(key, sortCostItems(children)));

  const result: ContractCostItemOption[] = [];
  const visit = (parentId: string | null, depth: number, prefix: string) => {
    (byParent.get(parentId || 'root') || []).forEach((item, index) => {
      const displayIndex = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      result.push({
        item,
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        depth,
        displayIndex,
        label: `${displayIndex} - ${item.symbol} - ${item.name}`,
      });
      visit(item.id, depth + 1, displayIndex);
    });
  };

  visit(null, 0, '');
  return result;
};

export const resolveContractCostItem = (
  items: ContractCostItem[],
  rawValue: unknown,
  options: BuildOptions = {},
): ContractCostItem | null => {
  const value = normalizeLookup(rawValue);
  if (!value) return null;

  const optionRows = buildContractCostItemOptions(items, options);
  return optionRows.find(option =>
    normalizeLookup(option.id) === value
    || normalizeLookup(option.symbol) === value
    || normalizeLookup(option.name) === value
    || normalizeLookup(option.label) === value
    || value.split('-').map(part => normalizeLookup(part)).includes(normalizeLookup(option.symbol)))?.item || null;
};

export const inferProjectCostCategoryFromCostItem = (
  itemOrSymbol?: ContractCostItem | string | null,
): ProjectCostCategory => {
  if (!itemOrSymbol) return 'other';

  // 1. Check explicit metadata category set on item
  if (typeof itemOrSymbol === 'object' && itemOrSymbol.category) {
    return itemOrSymbol.category;
  }

  const symbol = (typeof itemOrSymbol === 'string' ? itemOrSymbol : itemOrSymbol.symbol || '').trim().toUpperCase();
  const name = (typeof itemOrSymbol === 'object' ? itemOrSymbol.name || '' : '').trim().toLowerCase();
  const costType = (typeof itemOrSymbol === 'object' ? itemOrSymbol.costType || '' : '').trim().toLowerCase();
  const text = `${name} ${costType}`;

  // 2. Smart Symbol Pattern Match
  if (['CPVL', 'CPNVL', 'VL', 'NVL', 'VAT_TU', 'VATTU'].includes(symbol) || symbol.startsWith('CPVL') || symbol.startsWith('CPNVL')) {
    return 'materials';
  }
  if (['CPNC', 'NC', 'NHAN_CONG'].includes(symbol) || symbol.startsWith('CPNC')) {
    return 'labor';
  }
  if (['CPMTC', 'CPM', 'MTC', 'MAY'].includes(symbol) || symbol.startsWith('CPMTC')) {
    return 'machinery';
  }
  if (['CPTP', 'TP', 'THAU_PHU'].includes(symbol) || symbol.startsWith('CPTP')) {
    return 'subcontract';
  }
  if (['CPQL', 'CPL', 'CPL1', 'CPGT', 'CPNG', 'CPC', 'CPBH', 'CPVP'].includes(symbol)
      || symbol.startsWith('CPQL') || symbol.startsWith('CPL') || symbol.startsWith('CPGT') || symbol.startsWith('CPNG')) {
    return 'overhead';
  }

  // 3. Fallback Smart Keyword Matching on Name & CostType
  if (/vật liệu|nguyên vật liệu|vật tư|phụ liệu|vật tư phụ/i.test(text)) return 'materials';
  if (/nhân công|thợ chính|thợ phụ|tiền công|nhân lực/i.test(text)) return 'labor';
  if (/máy thi công|giờ máy|ca máy|máy móc|thiết bị thi công/i.test(text)) return 'machinery';
  if (/thầu phụ|giao thầu|tổ đội thầu|nhà thầu phụ/i.test(text)) return 'subcontract';
  if (/quản lý|lương|văn phòng|bch|ban chỉ huy|gián tiếp|ngoại giao|tiếp khách|hành chính|bảo hiểm|lễ tết|chi phí chung/i.test(text)) return 'overhead';

  return 'other';
};

export const getContractCostItemSnapshot = (
  item: ContractCostItem,
  status: ProjectCostClassificationStatus = 'manual',
): Pick<ProjectTransaction,
  'contractCostItemId'
  | 'contractCostItemSymbolSnapshot'
  | 'contractCostItemNameSnapshot'
  | 'costClassificationStatus'
> => ({
  contractCostItemId: item.id,
  contractCostItemSymbolSnapshot: item.symbol,
  contractCostItemNameSnapshot: item.name,
  costClassificationStatus: status,
});

export const clearContractCostItemSnapshot = (): Pick<ProjectTransaction,
  'contractCostItemId'
  | 'contractCostItemSymbolSnapshot'
  | 'contractCostItemNameSnapshot'
  | 'costClassificationStatus'
> => ({
  contractCostItemId: null,
  contractCostItemSymbolSnapshot: null,
  contractCostItemNameSnapshot: null,
  costClassificationStatus: 'unclassified',
});

export const applyContractCostItemToTransaction = <T extends Partial<ProjectTransaction>>(
  tx: T,
  item: ContractCostItem,
  status: ProjectCostClassificationStatus = 'manual',
): T & ReturnType<typeof getContractCostItemSnapshot> => ({
  ...tx,
  ...getContractCostItemSnapshot(item, status),
});
